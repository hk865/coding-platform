# Check the PC-1 task book (first full review)

You are reviewing, read only, the lead's task book for PC-1 (below, after the rules). The tree at `D:\cxt\pc` is the
lead branch at `dc462a95`. The frozen spec is `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md`.
Your own inventory for this book is `D:\cc-lead-notes\codex2\pc\inv-pc1.out.md` (read it if useful); the DSH
read-through is `D:\cc-lead-notes\impl\pc\replies\pc1-preread-final.md`.

Do not change any file. No tests, builds, git or network.

## What to check

1. **Against the spec.** Every ruling either implements the spec or fills a gap the spec left; flag any ruling that
   contradicts the spec, drops a spec requirement of PC-1's part (P2 freezing and start check, P3, P4, P5), or
   widens it. Flag spec requirements of PC-1's part that no ruling or row covers.
2. **Against the code.** Each file:line and each claim about today's behaviour. Wrong or stale places, functions that
   do not exist, flows that do not work the way the ruling assumes (e.g. the Query reservation/admission order, the
   Work permit command id, `withPresentations`, the resume branch, the default Skill config, `FileSkillLoader` being
   public, the generated pack module, `runtime-assets.json` and `check-boundaries.mjs`).
3. **The run split.** PC-1a = groups K and C; PC-1b = P, S, R. After PC-1a alone, the tree must typecheck, build,
   pass `check:architecture` and keep every existing test green. Does any C or K change force an edit in a file the
   book gives to PC-1b, or break an existing test outside §5.3? Within PC-1b, can P, S and R really work on
   disjoint files, and are the three seams listed in §4 enough to freeze before they start?
4. **Rows.** Can each §5.2 row be written through public steps with the fixtures of §5.1 and hand-computed
   expectations? Name missing fixture capabilities. Check PC-15's and PC-16's numeric examples against
   `model-budget.ts` and the runner.
5. **Old tests.** Is §5.3 complete for PC-1 and no wider than needed? Name other existing tests the rulings will
   break (file:line, why), and any listed one that will not need a change.
6. **Gaps and ambiguities** that would make two careful implementers build different things. For each: the place,
   the options, your proposal.

## Answer

Chinese is fine. Number your findings. For each: severity (阻塞 / 应改 / 可选), the ruling or row, the evidence
(file:line), and the change you propose to the book text. End with one line: `结论：可冻结` or `结论：改后再核`.

---

# The book
