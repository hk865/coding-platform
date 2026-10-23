# PC-2 audit, part W: the ten tool factories take tool texts (rulings 20's fallback, 21; PC-24)

Your part is `W`: `./.lead-ref/parts/W.diff` and `W-files.txt`: the ten tool files of ruling 21
(`src/core/agent-runtime/{command-rerun-tools,communication-tools,exploration-tools,graph-tools,note-tool,
project-source-tool,readonly-command-tool,session-discovery-tools,unknown-call-review-tools,whiteboard-tools}.ts`) and
the ten `tests/runtime/PC2-W-*.test.ts`. **The diff is against `pc1-final`, so it includes W's first commit `99e15bc`
(built before the book was frozen, never audited; its reply is `replies/pc2w-reply.md`) and the rework in this run.**
Audit the result as a whole. The book §3.6 rulings 20 (the per-tool fallback) and 21, §5.2 PC-24, the lead's check
rulings 8 and 16 (`books/pc2-chk1-rulings.md`, `pc2-chk2-rulings.md`).

**Look hardest at:**

- **The per-tool fallback** in every factory: `texts?.[name] ?? PLATFORM_PROMPT_PACK_V1.tools[name]!` for each tool
  the factory builds, never a whole-object default; a factory never reads a pack or the disk. List every call site
  (there were ~10 whole-object defaults); one left is a finding.
- **Byte equality.** With no texts, and with `PLATFORM_PROMPT_PACK_V1.tools` passed explicitly, every tool's
  specification (name, description, the JSON schema with every parameter description) is byte-equal to `base/`'s.
  Compare each schema the old code built at import with the new one built inside the factory, field by field,
  including key order inside the schema objects (the request body is serialized; a reordered key changes the bytes
  sent). A difference is **会出错**.
- **Pass-through.** `exploration-tools.ts` hands `texts` to `createProjectSourceTool`; `readonly-command-tool.ts`'s
  `registerReadonlyCommandTool` input gains `texts?` and passes it to `createReadonlyCommandTool`. Any sub-factory or
  wrapper that drops it?
- **Whiteboard parameters:** `propose_future_plan` and `apply_future_plan` each read their own
  `parameters['expected[].ref']` / `['expected[].revision']` from their own entry, never from
  `PLATFORM_PROMPT_PACK_V1.strings` or the other tool's entry (D8). The platform v2 JSON holds them (T's files; read
  `resources/prompts/platform/tools/{propose,apply}_future_plan.json`), and the sent bytes are unchanged.
- **The `!` non-null assertion:** for a name with no platform entry the fallback is `undefined`. Can any factory be
  asked for a name the generated pack lacks? If yes, what happens (a crash at registration?), and should it be a
  typed error? Reply §2 mentions a "typed platform tool-text fallback" (commit `93fbeab`): read what it does.
- **PC-24's coverage:** all 31 tool descriptions and one parameter of each of the eight non-empty `parameters` tables
  (`apply_future_plan`, `list_files`, `propose_future_plan`, `propose_safer_method`, `record_unknown_call_review`,
  `request_command_rerun`, `run_readonly_command`, `search`), each a literal; the deep-equal cases without texts and
  with the platform tools passed explicitly. Count the descriptions the tests actually change and assert; a missing
  one is a finding. Would a test catch a factory that read `texts[name]` for one tool but the platform text for its
  sibling? Would it catch a parameter description still built at import?
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
