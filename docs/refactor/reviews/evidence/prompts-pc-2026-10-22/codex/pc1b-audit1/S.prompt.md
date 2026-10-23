# PC-1b audit, part S: the send path (rulings 16, 20–25)

Your part is `S`: `./.lead-ref/parts/S.diff` and `S-files.txt`: `src/core/agent-runtime/{model-budget,observed-model-run,
execution-driver,query-execution}.ts`, the deletion of `resources/skills/platform-*` and its `runtime-assets.json`
entries, the new helper `tests/runtime/PC-frozen-prompt.ts`, the new `tests/runtime/PC-model-budget-preview`,
`PC-send-*` tests, and the old direct `runObservedModel` tests (`B1-kernel-assembly`, `cpp-source-index`, the three
`R4c-*`, `source-text-loop-migration`, `source-tool-lifecycle`). The book §3.4, §4 (S's row), §5.2 PC-15, §5.3 (S's
lines).

**Look hardest at:**

- **Ruling 20.** One "make the final request" transform, used by the preview; the client wrapper no longer adds
  `systemInstruction` (now inside the base) or `responseFormat`. With a Host instruction and a `responseFormat`, is
  the request the provider receives byte-equal to the base tree's? Give both if not.
- **Ruling 21.** The preview is a method of the run's existing `ModelBudget`; the measuring is one side-effect-free
  async function shared with `wrap`; the preview pushes, persists and reserves nothing; async counters are awaited;
  the next preview reads the same `totals()`.
- **Ruling 22.** The required `prompt` option replaces `skills` and `systemInstruction`; the drivers fill it from
  `promptSet` through `prompt-set-texts.ts`; `runObservedModel` passes `baseSystemPrompt`, `skills`,
  `reasoningReplay`, `previewRequest` and `onContextSelected` to the Kernel.
- **Ruling 23.** Both files of each platform Skill and the ten asset entries deleted (hash `runtime-assets.json`'s
  remaining entries against the files). DSH's question (reply §1 item 3, §9 item 1): git keeps no empty directory, so
  a clean checkout has no `resources/skills`; `tests/app/PC-host-prompt-selection.test.ts:262` asserts that
  `PLATFORM_SKILL_RESOURCE_ROOT` exists. Confirm whether anything else is tracked under `resources/skills`, whether
  that test fails from a clean checkout, and what else reads that directory. Give the fix you would rule (that test
  is outside PC-1b's whitelist).
- **Ruling 16.** The start and resume check compares `promptSelectionOf(model)`'s three fields plus `provider` and
  `model` with `promptSet`; a difference is `forbidden`; a resume without a live handle still answers `busy` first;
  Query compares before entry only. **DSH skips the whole comparison when `model.selection` is undefined** (reply §1
  item 1, §4 item 2) to keep `tests/work-graph/S3-prepared-context-admission.test.ts` green, which prepares with one
  model (`test/test`) and starts with another (`deepseek/s2b-runtime-steps-model`). Is that a test-only path in
  production (rule 5 of the common part)? Under ruling 16, should that old test now be `forbidden`, and is the right
  fix to start it with the model it prepared with? Can any production path build a `BoundModel` without `selection`?
- **Reply §1 item 2, §4 item 3:** the frozen fixture's `frozenPromptInputs` uses `tools: []`, which the WP2 Role
  install rejects; DSH added `tests/runtime/PC-frozen-prompt.ts` instead. Is the helper argument plumbing only, built
  with the production functions of rulings 14–15 (§5.1)? Is the fixture's failure real (cite the rejecting line)?
- **Ruling 24.** Reports keyed by `requestId`, never "the last report"; the facts computed before the meter reserves,
  from the request handed to the wrapper; `maxOutputTokens` = the cap the meter applies, for both kinds of run; Work
  stores the whole facts, Query drops `maxOutputTokens`; `requestDigest` keeps its meaning.
- **Ruling 25.** `onConfiguration` stays synchronous: copy, sort as `buildModelRequest` does, `JSON.stringify`, start
  the put, keep the promise, attach a rejection handler at once; awaited before the first request reaches the meter;
  each request's tools digest checked; a failed store or a mismatch → no reservation, no `beforeCall`, no provider
  call, the run fails `unavailable` through `RuntimeModelCallRejected`; later requests reuse the ref on start and
  resume.
- **Reply §4 item 6:** `SkillContext` through P's `PromptSkillV1` alias.
- **PC-15's platform case is not done** (reply §8). Is DSH's account of the fixture's limits true (cite the lines)?
  What is the shortest test that meets §5.2 within the frozen fixture, or what must the fixture gain?
- **The tests:** PC-15's reserve case (956 / 900 hand-computed), PC-10's S half, the start check (`PC-send-start-check`,
  each field changed alone, model called zero times), the old callers (arguments only; B1's three `skills` cases moved
  to preparation with the same three expectations). Name a mutation each would miss.
## What you are auditing

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. You may run
commands that only read (search, `diff` of two files, hashing a file). Answer in plain Chinese, with `file:line` for
every fact.

This tree is run **PC-1b** of the prompts-and-context construction (decision 83-4): groups **P** (freezing at
preparation and the entry re-render), **S** (the send path), **R** (records and the read) and the **joint step** of
the frozen book `./.lead-ref/books/pc1-book.md` (v3). DSH built it on base `pc1b-base` = PC-1a with its rework 1
(merged K and C) plus one commit with the frozen fixture `tests/helpers/PC-platform-fixture.ts`. Commits are in
`.lead-ref/commits.txt`. This is the first audit (decision 80): your findings become the frozen table for rework 1 (at
most three reworks). Report everything you can prove, and nothing you cannot. PC-2 (packs on disk, the person's pack,
the context plan) builds on this tree; a wrong or missing interface is a finding.

Inputs in `./.lead-ref/`:

- **The book** `books/pc1-book.md`: §1, §2 (the rules for all groups), §3.3 (P, rulings 14–19), §3.4 (S, rulings
  16, 20–25), §3.5 (R, rulings 26–30), §4 (groups, owners and the frozen seams block), §5 (fixtures, rows PC-06…PC-10
  and PC-15, old tests §5.3), §6. Binding. §3.1–§3.2 (K and C) are merged; read them only for names. The run sheet
  `books/run-pc1b.md` and the whitelist `books/pc1b-whitelist.txt` (regular expressions on paths).
- **The frozen spec** in the tree: `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`
  (P1–P5, §2, §3.2).
- **Codex's inventory and book checks** (Chinese): `books/inv-pc1.out.md`, `books/chk1.out.md`, `chk2.out.md`,
  `chk3.out.md`.
- **PC-1a's interface table** `replies/pc1a-interfaces.md` (§4) and its rework reply `replies/pc1a-r1-reply.md`.
- **Your part:** `parts/<P>.diff` (against `pc1b-base`) and `parts/<P>-files.txt`. The base version of every changed
  file is at the same relative path under `base/`; a new file has no base. The whole result tree is the current
  directory.
- **DSH's reply** (claims, not evidence): `replies/pc1b-reply.md`. Its §1 (questions), §4 (where it left the §4
  seams and why), §8 (PC-15 not done) and §9 (what it thinks the book or sheet got wrong) are DSH's own account;
  check each item that touches your part against the book and the code, and say whether DSH's way holds.
- **Tests:** the lead runs them separately (the full suite included); you do not need results.

## What to check (every part)

1. **The rulings of your part**, one by one: built exactly as the book says? Cite the book line and the code line.
   Where the book leaves a choice, is the choice reasonable and stated in the reply?
2. **Behaviour where the book promises none changes** (§2 rule 1): with the platform pack and no new input, the
   prompts, manifests, requests and records are as before, byte for byte where the book says so. A difference for
   some input is **会出错**: give the input, the old output and the new output.
3. **Tests (decision 80 bar):** every row of your part is tested through the public step the book names; expected
   values are literals or hand-computed, never taken from production code; no test reads the database or a private
   module to check a fact; a test would fail if the rule it guards were broken (name a mutation it would miss). Old
   tests: only those §5.3 names may change, only for the reason it gives, and their assertions stay unless §5.3 says
   otherwise.
4. **Scope:** every hunk is asked for by the book for your group, or is an import or type the change needs;
   otherwise **违规**. No file outside the whitelist; the frozen fixture changed only as the reply admits (reply §4
   item 9), and that change is type-only.
5. **No test-only paths in production:** a branch, option or export that exists only so a test passes is **违规**.
6. **Comments:** rules and "why" kept with the code; no construction history ("r1 did …", "moved from …").

## Answer

1. **Findings table:** 编号 (`<P>-01` …) | 类别 | 位置 (`file:line`) | 依据 (book ruling or row, spec item) | 问题 |
   唯一改法. Classes: **会出错** (a behaviour differs from the book or the spec for some input, or an interface PC-2
   relies on is wrong: give the input and both outputs), **违规** (against the book, the run sheet or the spec,
   including a test below the bar), **不整洁** (stale comment, dead code or import), **建议** (optional). One fix per
   finding: if the right fix needs a lead ruling (e.g. a change outside the whitelist), say so and give the fix you
   would rule.
2. **Per ruling and row:** one line each: `<ruling or row>: OK` or `<…>: <P>-nn, …`.
3. **DSH's own items** that touch your part (reply §1, §4, §8, §9): one line each, `成立` / `不成立` and why.
4. **The same findings as JSON**, in one fenced ` ```json ` block: `[{"id", "class", "file", "line", "basis",
   "problem", "fix"}]`.
5. **One last line:** `会出错 n，违规 n，不整洁 n，建议 n`.
