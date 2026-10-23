# PC-2 audit, part G: the guard, the entry and I-19 (ruling 12; PE9)

Your part is `G`: `./.lead-ref/parts/G.diff` and `G-files.txt`: `src/core/work-graph/state/context-input.ts`,
`src/core/work-graph/tasks/execution-entry-service.ts`, `src/core/work-graph/queries/query-execution.ts` (the Query
manifest check of the new fields), `tests/state/invariants.ts` and the old tests G owns (book §4 and §5.3:
`tests/state/invariants.test.ts`, `context-input.test.ts`, `WP1-goal-content.test.ts`,
`tests/work-graph/S3-prepared-context-admission`, `K3-35-owner-manifest-trim`, `tests/runtime/K3-unknown-call-review-section`,
`tests/helpers/WP1-units-fixture.ts`), and G's new tests (`tests/state/PC2-G-context-order`,
`tests/work-graph/PC2-G-entry-guard`). The book ruling 11 (the binding's order), ruling 12, §5.2 PE9 rows and PC-21's
guard half, §5.3 (G's lines).

**Look hardest at:**

- **The guard.** `SECTION_ORDER` dropped; the binding's `sectionOrder` checked itself (role first, each once, inside
  the call kind's legal set, `goal` and `task` present where required today); the sections appear in that order; the
  re-rendered text accepted only when the binding's byte range equals it (`utf8Slice`, not only the ends) **and** it
  occurs exactly once in the input; the brief and review no longer required last or at the end. Does the guard still
  reject everything it rejected before that the book did not loosen (a missing section, a range outside the input,
  overlapping ranges, an omission marker it checks with literals)? A loosening the book did not ask for is
  **会出错**: give the input that used to be rejected and is now accepted.
- **"Exactly once".** How is uniqueness checked (`indexOf` / `lastIndexOf`)? Does an occurrence that overlaps the
  range itself, or one inside another section, count? Is the check on bytes or UTF-16 indices, and can a multi-byte
  character make the range check and the uniqueness check disagree?
- **The entry.** At `execution-entry-service.ts` (brief ~975, ~1201; review ~1053): reads the frozen template and
  string table back, re-renders with `promptSet.toolNames`, calls the guard's range-and-unique check; never the
  current pack; a changed character still `invalid`. WorkGraph imports no Runtime module.
- **The Query manifest check** (`queries/query-execution.ts`): the new required fields (`sectionOrder`,
  `takesSessionHistory`, the tool fields) checked, not just passed.
- **I-19** checks by the binding's range in the same way and does not assume a fixed line.
- **Old tests:** each change is the mechanical one §5.3 names (sectionOrder added, the new required manifest fields,
  the tail assumption removed); no other assertion weakened. Compare each changed old test hunk with `base/`.
- **Tests:** PE9's separate rows (a wrong range, a duplicated text, a non-tail success) through the public entry with
  literal inputs; `PC2-G-context-order`'s four mutations (role first, legal name, duplicate, order). Name a mutation
  each would miss (e.g. comparing only the range's start, checking uniqueness with `includes`, accepting an order that
  is legal but differs from the frozen set's).
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
