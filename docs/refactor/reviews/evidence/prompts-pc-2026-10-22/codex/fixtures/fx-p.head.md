# Write the PC-1b platform test fixture (read only: give the file in your answer)

The tree at `D:\cxt\pc1a` (your working directory) is the lead branch with PC-1a: the DSH copy's HEAD `afff716`, not yet audited; `.lead-ref/replies/pc1a-am-reply.md` §4 lists what K and C froze. The Kernel's new inputs and C's
contracts (`src/contracts/prompts/prompt-set.ts`, `platform-skills.ts`, the platform pack source) exist. The PC-1 task
book follows below; PC-1b's groups P, S and R (rulings 14–30) change preparation, the send path and the request
records, and its joint step writes rows PC-06…PC-10 and PC-15's platform cases (book §5.2). DSH writes those tests
against a fixture you write now; the lead checks it and freezes it, and DSH may not edit it. Do not change any file;
no tests, builds, git or network. Give the complete new file in your answer, in one fenced block, ready to save as
`tests/helpers/PC-platform-fixture.ts`.

It will not typecheck until P, S and R meet the book's §4 seams. Write it against:
- the names that exist in the tree now (C's and K's, as merged);
- for what PC-1b adds, only the names the book freezes: §4's seams block, rulings 22 (`prompt` option), 26–30.

Import only what the existing tests import: public steps of the platform (Host, routes, the Runtime's public
port, WorkGraph commands through their public services) and the existing test helpers. Never read the database to
check a fact, never call a real model, never touch the network.

## What the fixture must give

Reuse the existing helpers rather than re-building a platform; name the one you reuse for each item. Candidates:
`tests/helpers/K3-35-continuation-fixture.ts`, `K3-proposal-round.ts`, `K3-review-card-fixture.ts`,
`RL-query-fixture.ts`, `C2-runtime-platform-fixture.ts`, `B2-execution-fixture.ts`, `S2B-be1-platform-fixture.ts`,
`WP2-platform-support.ts`.

1. **Work** prepare, start, pause and resume through the formal control steps. Pause and resume are Work's only.
2. **Query** prepare and start.
3. **A continuation and a K3 review or proposal,** both reached through public steps, so that the entry's brief
   check and its review-or-proposal check run (book ruling 17).
4. **A scripted model** that records a deep copy of every request it receives, and can return text, tool calls,
   `reasoningContent` and usage.
5. **An injectable `PromptPackSourcePort`** (C's, as merged) whose resolved pack the test can change between steps
   (the `base` text and a string label at least), passed through `RuntimeDeps.promptPacks` (ruling 30).
6. **A custom Skill directory** the test can rewrite between steps, selected through the model's Skill selection.
7. **An async counter**, injectable where the meter takes one (`model-budget.ts`), that resolves on a later tick and
   returns a fixed count.
8. **A body store wrapper** that fails `put` for one given content type and passes everything else through.
9. **The real Host registry:** install a new binding after preparation and show the execution stays pinned to the
   old one. Also a Host whose binding resolution returns a different binding on its second call.
10. **Capture and replay** of the Work authorization command (`b2-model-authorize:<requestId>`) and of the Query
    reservation and admission commands, exactly as written, with a way to replay one with one changed fact.
11. **`readPromptRecord` access** for a Work and a Query execution (ruling 29), through the Runtime's port.
12. **`frozenPromptInputs(...)`** for the direct `runObservedModel` callers of book §5.3. It builds the `prompt`
    option of ruling 22 with the production functions of rulings 14–15 (resolve the platform pack, render `base`,
    merge an optional Host instruction, select Skills). It is argument plumbing only: it never computes an expected
    value.
13. **A clock** that gives two consecutive Work permits the same `issuedAt` (PC-09).

Keep it under about 600 lines. After the file, list each export with its signature, which existing helper it reuses,
and every place where you were unsure of a name (with the declaration you used, or the book line you followed).

---

# The PC-1 book
