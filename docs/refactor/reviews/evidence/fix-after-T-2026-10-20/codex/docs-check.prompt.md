# Fix round after T: check of the docs before the commit

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact.

This tree is the lead branch after the fix round after T (HANDOFF decision 86) was merged: the six code commits in
`./.lead-ref/commits.txt` (TF1 … TF5 and one commit with both reworks and the lead's five small fixes), plus the docs
the lead is about to commit. `./.lead-ref/docs.diff` is the whole docs change (the decision-86 text in HANDOFF, written
earlier by the lead; the DSH draft for the round; the lead's edits after a line-by-line review). The new evidence folder
`docs/refactor/reviews/evidence/fix-after-T-2026-10-20/` holds its README and the materials (books, DSH replies, Codex
answers, checks, the memory profile and the scale inventory). The old workbench `src/ui` is deleted in this tree; the
last commit with it is tagged `old-ui-last` (`4679c7e3`, not in this copy).

`【lead 填】` marks the numbers of the final full suite, which is still running; ignore those places.

## What to check

1. **Every new or changed statement in `docs.diff` and in the evidence README** against this tree's code and the
   evidence files: commit hashes, counts (files, lines, rows, tests, allowlist entries), what was deleted, kept or
   changed, behaviour claims (AD08's refusal, the Host's answer when no page is built, the three records the codecs
   now refuse), rulings and their reasons, times and usage numbers (`checks/dsh-runs.txt`, `checks/codex-calls.txt`,
   the check files). Anything that does not hold is **错**; true but likely to mislead a later agent is **误导**.
2. **Current docs that still describe the old workbench as present.** Read the current (not historical) docs:
   `README.md`, `AGENTS.md`, `docs/AGENTS.md`, `docs/README.md`, `docs/MVP-BEHAVIOR.md`, `docs/UI-WORKBENCH.md`,
   `docs/refactor/STATUS.md`, `docs/refactor/IMPLEMENTED-CAPABILITIES.md`, the design folder
   `docs/refactor/design/orchestration-2026-10/` (README, DESIGN, E3-UI-ITEMS, the slices README and the specs of
   slices that are not merged yet: 6, 7, 8, K2, 9), `docs/refactor/module-dag.md`, `docs/refactor/DSH-WORKFLOW.md`.
   A sentence that tells a reader to run, build, open or change `src/ui`, `tsconfig.ui.json`,
   `scripts/build-workbench.mjs` or the old browser page as if it exists now, with no dated note saying it is gone,
   is **漏**. Do not report historical reports, evidence folders, `history/`, `archive/` or HANDOFF history (they keep
   their original wording by rule; `AGENTS.md` rule 7).
3. **Consistency:** the same fact told differently in two places (commit count, row counts, which items are left and
   where they are tracked) is **不一致**.

Do not report style, wording preferences or things the lead chose (the rulings themselves). Report only what you can
prove from this tree.

## Answer

A table: `编号 | 类别（错/误导/漏/不一致） | 位置（file:line） | 问题 | 依据（file:line） | 改法`. Number the rows D-01,
D-02, …. Then one line per checked file that has no problem ("OK"). End with one line:
`错 N，误导 N，漏 N，不一致 N`.
