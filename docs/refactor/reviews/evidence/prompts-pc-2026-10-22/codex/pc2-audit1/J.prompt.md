# PC-2 audit, part J: the joint rows and the allowlist

Your part is `J`: `./.lead-ref/parts/J.diff` and `J-files.txt`: the new `tests/app/PC2-joint-*.test.ts` and
`tests/runtime/PC2-joint-*.test.ts`, the old PC-1 joint tests it changed (`tests/runtime/PC-joint-*`), and
`tests/architecture/production-reach-allowlist.json`. You may read the whole tree to judge them. The book §2 rule 3
(the allowlist), §4 (the joint rows and order), §5.1 (the three fixtures), §5.2 PC-03, PC-04 (prepared vs new), PC-05,
PC-06 and PC-08 (PC-2 variants), PC-18, PC-20, PC-21, PC-26.

**Look hardest at:**

- **Each joint row against §5.2, line by line.** For each bullet of each row: which test case carries it (file:line),
  through which public steps (Host routes, preparation, start, resume, `readPromptRecord`), with which literal
  expectations. A bullet with no case is a finding; say whether it can be carried within the frozen fixtures and the
  rules, and how.
  - PC-04 prepared vs new: a save through the route after a preparation; the prepared Run's start uses the old text,
    a new preparation the new one.
  - PC-05: two models with their own packs (markers A and B); no fields → `platform` / `current_run` and the read
    shows none; a restart after a save that omits them still resolves the defaults.
  - PC-06/PC-08: the person's pack changed after preparation (with a `strings.json` label) leaves the prepared run
    unchanged; a model's pack changed in settings after preparation: this execution old pack, a new one the new pack.
  - PC-18: reminder counts (new Session 0, LA-1 seed 1, same-Session reuse 1); placement also with all four budget
    sections omitted; the brief without the sentence; decided once in assembly; a K3 seed and a Query
    `session_history` through the one rule; a Query with basis reads no boundary.
  - PC-20's prepare-to-request part: read; read with edit and shell; no read — through the platform fixture's
    permission `tools`.
  - PC-21: the K3 shrink with a reminder after the review, ranges hand-computed, guard and entry pass, a changed
    character `invalid`, a legal other order followed.
  - PC-26: Work and Query with `list_files`, Work with `record_note`; the changed texts in the request; the frozen
    entry's digest hand-computed; changed again after preparation → start and a Work resume after pause send the
    prepared texts; `readPromptRecord`'s `toolSpecsRef` body holds them; the body store failing only
    `PROMPT_TOOL_TEXT_CONTENT_TYPE` → preparation `unavailable`.
- **Reply §1.3 and §8.5 (fixture defects):** `openPC2QueryHistoryFixture` cannot capture `startQuery` (the Workflow
  calls the Runtime object's method, not the spied port), so the Query-with-basis execution half is uncovered;
  `openPC2ReviewFixture('empty')` gives `invalid` from an empty required slot (`k3.none: ''`); the LA-1 non-empty seed
  is unreachable with the frozen fixtures; read+edit+shell only through renderer literals because the platform
  fixture hard-codes `writeScope: []`; the public no-read list uses `['search']`. For each: confirm by reading
  `tests/helpers/PC2-pack-fixture.ts`, `PC2-host-fixture.ts`, `PC-platform-fixture.ts`; if the fixture is at fault,
  give the smallest fixture patch; if the row can be carried another way within the rules, say how; if the row truly
  cannot be carried by any public path, say so.
- **Test bar:** every expected value a literal or hand-computed (digests as `sha256` of literal strings); no value
  from production code, the generated pack, `preparedTexts()`, a manifest or a captured request; whole texts compared
  whole; no database reads. Name a mutation each row would miss; check DSH's claimed mutations (reply §3, joint line)
  by reading the assertions.
- **The old PC-1 joint tests** (`PC-joint-budget-removal`, `PC-joint-prepare-freeze`, `PC-joint-record-and-failure`):
  each change forced by a ruling (the 57-byte brief sentence, `set.tools`, `base` v2) and nothing else loosened.
- **The allowlist** (book §2 rule 3): DSH removed nothing and changed three `wire-format` notes to "E3 adds the HTTP
  route" (reply §7). Read the allowlist's own test under `tests/architecture/` and the existing entries' categories.
  For each PC-2-touched entry: is the declaration reached by production now (then the entry must go)? Is each kept
  entry's named consumer real? Is any new PC-2 export (A's `resolvePromptPackV1` helpers, H's DTO types, T's
  `rerenderContextV1` / `ContextRenderMaterialV1`, Q's `finalToolNamesOf`, `sessionHistoryDecision`) unreached and
  unlisted, or exported only for a test?
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
