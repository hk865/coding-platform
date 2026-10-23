# PC-2 audit, part Q: preparation to request (rulings 13's call, 14, 16, 18, 19, 20)

Your part is `Q`: `./.lead-ref/parts/Q.diff` and `Q-files.txt`: `src/core/agent-runtime/{execution-preparation,
query-preparation,execution-driver,query-execution,observed-model-run,tool-group-assembly,prompt-set-texts,
context-history-facts,runtime}.ts`, Q's new tests (`tests/runtime/PC2-declaration-prepare`, `PC2-history-decision-pure`,
`PC2-review-shrink`, `PC2-tool-texts-freeze`) and the old tests it changed (`K3-35-manifest-trim-pure`,
`K3-review-preparation`, `tests/contracts/PC-prompt-texts-store`, `tests/runtime/PC-prepare-*`,
`PC-read-record-work-query`, `PC-send-*`). The book rulings 13 (the shrink's calls), 14 (the decision, the boundary
read, start), 16 (the final tool list), 18 (declarations), 19 (storing tool texts), 20 (start and resume), §4 (Q's
row), §5.2 PC-18, PC-19, PC-21 (shrink), PC-26, §5.3 (Q's lines).

**Look hardest at:**

- **Ruling 16, `finalToolNamesOf`.** Every input field from the fact the book names; `reviewSource` independent of
  `frozenSource`; rejections first (unknown selected name, a selected family missing its owner, a review phase
  without the `unknownCallReviews` owner), then the array in today's `kernelEnabledToolNames` order, never sorted;
  the rerun tool only on a Work Run with blocked commands and no review purpose. Preparation computes it once after
  the permissions, frozen-source and material facts are fixed; start recomputes and compares a ready result exactly
  and in order, `forbidden` on a difference. Compare the output for every combination with what `base/`'s start-time
  registration produced: a list that differs from the tools the Run actually registers is **会出错**.
- **Reply §1.2 (behaviour moved).** DSH says ruling 16 moves the rejection of an unknown authorization to preparation:
  `requeue_task` / `reverify_round` are `unsupported` at prepare, and `C2` GAP-46, `invariants-fuzz` seeds
  4/14/16/23/43, `A2-requeue-service`, `R3e-reverify`, `S5-notices` expected prepare ready and start rejected. Trace
  it: where do `requeue_task` and `reverify_round` come from (a Role's tools, a workflow's permission set)? In
  `pc1-final`, does any **production** flow prepare with them and then start successfully (are they registered by some
  group at start that `finalToolNamesOf` does not know)? If a real flow now fails at prepare that used to run, that is
  **会出错**; if every such Run was rejected at start anyway, it is the ruling's consequence and the tests need a
  ruling — give, per test file, what it asserts and the exact change.
- **Reply §8.4:** preparation freezes by the capability set's owners and start rechecks the actual owners; the
  Query read-only gate judged by the frozen capability, the real policy rechecked at registration; "a Query final list
  keeps only its graph family" (commit `2f9a826`) — is that today's Query registration, or a narrowing? Check each
  against `base/`.
- **Ruling 14.** One rule `sessionHistoryDecision`; Work and a Query without basis pass the real completed boundary,
  read once in preparation; a Query with `sessionBasis` passes none and reads none (C7); the recipe calls the rule
  once; Q freezes `takesSessionHistory` from `historyDecision` unchanged; at start the rule runs again and a frozen
  `false` forces `current_turn`. **Reply §8.4, commit `af84802`:** `readCompletedHistoryBoundary` treats a stored
  cursor the platform cannot decode as "no decodable completed history" → `{cursor: null, position: 0}`, so the Run
  starts `current_turn`. What did `base/` do with such a cursor at start (pass it through to the Kernel, reject)? Which
  real flow writes such a cursor (DSH names the S1 tests' Workflow)? If a real Session with history now loses it, that
  is **会出错**; give the input and both outputs, and the fix you would rule (DSH says a stricter rule needs
  `session-operations.ts` or the S1 fixture, outside the whitelist).
- **Ruling 13's call.** The shrink calls `rerenderContextV1` per candidate and replaces input, sections, digest and
  the manifest measure from its result; no prefix cut remains; the algorithm and order of the shrink otherwise as
  before (redo one candidate by hand).
- **Ruling 18** at preparation: each **used** template's `origins[…].mentionsTools` ⊆ the frozen list, else `invalid`
  naming template and tool. **Ruling 19:** for each frozen name with an entry, the canonical body stored, `{ name,
  packId: toolOrigins[name], digest, ref }` recorded, sorted by name, inside the digest and the size measure; a failed
  put `unavailable`. **Ruling 20:** `readPromptTexts` verifies digest, size and content type; the Work driver and the
  Query execution call it once before building any tool and pass `tools` to every factory route the ruling lists
  (`runObservedModel`, `selectWorkToolGroup`, `createReviewToolGroup`, `createRerunToolGroup`,
  `registerReadonlyCommandTool`, the Query graph group and read-only command); `readPromptRecord` reads the tool-text
  bodies. A route that still builds a tool without the frozen texts is a finding.
- **A pack problem at preparation is `invalid`** (ruling 4's last bullet): `PromptRenderError` mapped to `invalid` in
  Work and Query; other renderer failures keep their codes.
- **Tests:** PC2-history-decision-pure (each branch of Work and Query), PC2-declaration-prepare, PC2-review-shrink,
  PC2-tool-texts-freeze; the old tests changed only mechanically. Name a mutation each would miss.
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
