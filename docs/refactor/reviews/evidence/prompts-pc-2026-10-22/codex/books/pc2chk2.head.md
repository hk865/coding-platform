# Check the PC-2 task book v2 (second full review)

You are reviewing, read only, the lead's task book for PC-2, version 2 (below). The tree at `D:\cxt\pc` is the lead
branch at `dc462a95`. The frozen spec is `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`;
decision 83-5 is its second post-note (lines 7–12) in the lead's worktree
`D:\1.project\Software\agent-next-main\.claude\worktrees\claude-code-task-execution-f3cca6`.

**Read only:** do not modify, create or delete any file; no tests, no builds, no git, no network. You may run commands
that only read. Answer in plain Chinese, with `file:line` for every fact about the code.

Newer than the tree:
- **W's commit `87f16ba`** (the ten tool factories take `texts?`) is in the base of this run. It is not in
  `D:\cxt\pc`; read it as a patch: `D:\cc-lead-notes\codex2\pc\w-87f16ba.patch`. The book's line numbers for those ten
  files are after this patch.
- **PC-1's frozen book** `D:\cc-lead-notes\impl\pc\pc1-book.md` (§3.2, §4) and PC-1a's as-built interface table
  `D:\cc-lead-notes\impl\pc\replies\pc1a-am-reply.md` §4. Treat those names as existing.

Inputs of this edit: your first review `D:\cc-lead-notes\codex2\pc\pc2chk1.out.md` (17 findings), the lead's rulings
on it `D:\cc-lead-notes\impl\pc\pc2-chk1-rulings.md` (they bind), and DSH's reply on the edit
`D:\cc-lead-notes\impl\pc\replies\pc2-book2-reply.md` (it lists 8 `[DSH choice]` items).

**The lead's line review already found these four; do not report them again** (they will be fixed in v3):
1. Ruling 10: `renderContinuationBriefZh` and `renderUnknownCallReviewZh` take `toolNames: readonly string` — must be
   `readonly string[]`.
2. `PromptSetV1.toolNames` is used (rulings 10, 13, 16, 19) but never frozen: v3 adds it to A's types (required,
   `string[]` in ruling 16's order, never sorted), to `decodePromptSetV1`'s strict check, to the manifest digest and
   the size measure, and to `PromptPartsV1` / `storePromptTexts` (Q writes it), like ruling 19's `tools`.
3. Ruling 20 step 2 says `toolTexts`; the reader returns `tools`; the factories take `texts`. v3 uses one wording.
4. Ruling 13: `AssembledContextV1.renderMaterial?` becomes required (both recipes fill it).

## What to check

1. **Status of your 17 findings:** for each, 已修 / 部分修复 (what is missing) / 未修. One line each.
2. **The 8 `[DSH choice]` items:** accept, or the change you propose and why.
3. **New problems the v2 edits introduced.** In particular:
   - signatures that would not compile, or name a type that exists neither in the tree, nor in W's patch, nor in
     PC-1's frozen book or PC-1a's table;
   - the owner table: a production or test file in two groups; a file a group must edit but does not own;
   - the one-run order (A's resolver interface first; T's rendering material and role-reminder slot before G and Q):
     is any seam a group needs missing from the book; can the tree be green at the end;
   - ruling 14's `sessionHistoryDecision` against `src/core/agent-runtime/execution-driver.ts` ~676–689 and
     `src/core/agent-runtime/query-execution.ts` ~473–494;
   - ruling 16's `finalToolNamesOf` input and output order against `tool-group-assembly.ts`, `execution-driver.ts`,
     `observed-model-run.ts`, `readonly-command-tool.ts` (after W's patch);
   - ruling 20's chain from the frozen bodies to each factory, with W's patch applied;
   - the arithmetic in PC-21 and §6.
4. **Rows:** can each new or changed row (PC-04, PC-05, PC-18, PC-20, PC-21, PC-23, PC-24, PC-25, PC-26, the PE8 and
   PE9 rows) be written through public steps with §5.1's fixtures and hand-computed expectations?

Only blocking or should-fix problems; no style remarks.

## Answer

First the status table (1), then the DSH choices (2), then new findings numbered, each with severity (阻塞 / 应改), the
place, the evidence (file:line), and the change to the book text. End with one line: `结论：可冻结` or `结论：改后再核`.

---

# The book (v2)
