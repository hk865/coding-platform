# Check the PC-2 task book (first full review)

You are reviewing, read only, the lead's task book for PC-2 (below, after the rules). The tree at `D:\cxt\pc` is the
lead branch at `dc462a95`. The frozen spec is `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`.

Two things are newer than that tree:
- **Decision 83-5** (the user, 10-22): a person's pack may change the platform tools' texts. Read it in the lead's
  worktree: the spec's second post-note at
  `D:\1.project\Software\agent-next-main\.claude\worktrees\claude-code-task-execution-f3cca6\docs\refactor\design\orchestration-2026-10\slices\slice-6-7-PROMPTS-SPEC.md`
  (lines 7–12) and `docs\refactor\HANDOFF.md` item 83-5 in the same worktree. The book's §3.6 builds it.
- **PC-1** is being built now. PC-2 builds on PC-1's interfaces as PC-1's frozen book freezes them:
  `D:\cc-lead-notes\impl\pc\pc1-book.md` (v3, frozen), §3.2 and the §4 seams block. Treat those names as existing.
  Two PC-1 steps are already committed in a DSH copy and match that book: the managed selection-policy source, and
  `base` plus the five platform Skills in the platform pack with `ResolvedPromptPackV1.origins`.

Your inventory for this book is `D:\cc-lead-notes\codex2\pc\inv-pc2.out.md`; the DSH read-through is
`D:\cc-lead-notes\impl\pc\replies\pc2-preread-final.md`. Do not change any file. No tests, builds, git or network.

## What to check

1. **Against the spec and decision 83-5.** Every ruling either implements the spec or fills a gap it left; flag any
   ruling that contradicts the spec or 83-5, drops a requirement of PC-2's part (P1 packs, resolution, validation and
   editing; P2 selection; P8 the stale-files reminder; P9 declarations and `base` v2; P10 section order, the guard,
   the binding and the entry check; 83-5 tool texts), or widens it. Flag requirements no ruling or row covers.
2. **Against the code.** Each file:line and each claim about today's behaviour: the settings routes and their gate,
   `host-settings.ts` atomic writes and serialization, the Host's workspace-open path and settings directory, the
   D3 parser in `render-template.ts`, the state guard's omission literals, the K3 review shrink, the
   `takesSessionHistory` rule, `kernelEnabledToolNames`, the ten tool files of ruling 21 and their module-level
   schemas, `tool-group-assembly.ts`.
3. **Against PC-1's book.** Does PC-2 use PC-1's names as PC-1 freezes them (`PromptSetV1`, `decodePromptSetV1`,
   `PromptPackSourcePort`, `ResolvedPromptPackV1.origins`, `readPromptTexts`/`storePromptTexts`, the start check of
   PC-1 ruling 16, `promptSelectionOf`)? Does it change a PC-1 interface without saying so?
4. **The run split.** PC-2a = A ∥ H ∥ W; PC-2b = T ∥ G ∥ Q, then the joint rows. Are the files of each run disjoint
   per group? After PC-2a alone, does the tree typecheck, build, pass `check:architecture` and keep the old tests
   green (other than §5.3's)? Are the seams named in §4 enough to freeze before the groups start?
5. **Rows.** Can each §5.2 row (PC-01…PC-05, PC-18…PC-26, the PC-2 variants of PC-06 and PC-08, the PE8 and PE9
   rows) be written through public steps with the fixtures of §5.1 and hand-computed expectations? Name missing
   fixture capabilities.
6. **Old tests.** Is §5.3 complete and no wider than needed? Name other existing tests the rulings will break
   (file:line, why).
7. **Size.** The book's §6 numbers against your inventory, including decision 83-5's part.
8. **Gaps and ambiguities** that would make two careful implementers build different things. For each: the place,
   the options, your proposal.

## Answer

Chinese is fine. Number your findings. For each: severity (阻塞 / 应改 / 可选), the ruling or row, the evidence
(file:line), and the change you propose to the book text. End with one line: `结论：可冻结` or `结论：改后再核`.

---

# The book
