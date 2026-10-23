# PC-1b audit, part J: the joint step and the allowlist (rows PC-06…PC-10, PC-15's platform case)

Your part is `J`: `./.lead-ref/parts/J.diff` and `J-files.txt`: `tests/architecture/production-reach-allowlist.json`
and the new `tests/runtime/PC-joint-*.test.ts`. You may read the whole tree to judge them. The book §4 (J's row and the
last paragraph), §5.1 (the platform fixture), §5.2 (PC-06…PC-10, PC-15).

**Look hardest at:**

- **Each joint row against §5.2, line by line.**
  - PC-06: after preparation, the injected pack (`base` text and a string label) and the custom Skill file change; the
    model still receives the prepared system and input, Work and Query; the entry's brief and review checks still
    pass; the set's digests equal `sha256` of literal texts.
  - PC-07: a formal pause, the pack and Skill file changed, resume; the system received is byte-equal to the first.
  - PC-08: a Host returning a binding with another `promptPack` on its second resolution → Work start `forbidden`,
    model called zero times; through the real Host registry, a new binding installed after preparation leaves the
    execution on the old one.
  - PC-09: Work and Query, each a tool call then a final answer; `readPromptRecord` read afresh: two requests in
    `sequence` order, both digests, the removal counts, the cap; the same `toolSpecsRef` twice; `sha256` of each text
    equals its digest; the system rebuilt by hand from the returned base and Skill texts, the sections written
    literally as `context-builder.js` ~20 writes them, has the recorded `systemDigest`; the captured Work authorization
    and Query reservation replayed with one changed fact → `idempotency_conflict`.
  - PC-10: the body store fails only `PROMPT_TOOL_SPECS_CONTENT_TYPE`; Work and Query fail `unavailable`, model called
    zero times; preparation had succeeded.
  For each: is every expected value a literal or hand-computed? Does the test go through the public steps and the
  frozen fixture only? Name a mutation of the production code that the row would miss.
- **PC-15's platform case is missing** (reply §8). Say what it would take within §5.1's fixture, and whether the
  missing row hides an untested rule of rulings 20–21 that no other test covers.
- **The allowlist.** DSH removed all 13 PC-1b `kept-for` entries PC-1a added and added 18 `wire-format` entries (reply
  §7): 9 for types and optional port members the reach walker cannot follow, 4 for `readPromptRecord`'s helpers
  (`messageOf`, `rejected`, `sameQueryRunRef`, `readQueryPromptSet`), `completeRunRef`, and 4 compatibility constants
  still referenced by old contract tests plus `INITIAL_COORDINATION_RESPONSE_GUIDE`. Read the allowlist's own rules
  (the test under `tests/architecture/` that reads it, and the existing entries' categories and note forms). For each
  new entry: is the category right, is the declaration really used by production, and should it be exported at all?
  An export that exists only for an allowlist entry, or a helper exported only to be listed, is a finding. Is any
  production export left unreached and unlisted?
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
