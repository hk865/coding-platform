Read-only facts check for the lead. Do not write any file, do not run tests. Answer in Chinese with file:line.

This copy is the lead branch with cleanup round C1 merged into `src` and the lead's edited DRAFT documents for C1 in place (DSH drafted them, the lead edited them):
- `docs/refactor/reviews/evidence/orchestration-cleanup-C1-2026-10-19/README.md` and `lead-acceptance.md` (new);
- `docs/refactor/STATUS.md`, `docs/refactor/IMPLEMENTED-CAPABILITIES.md` (the dated C1 line at the top), `docs/refactor/design/orchestration-2026-10/slices/README.md`, `AGENTS.md`, `docs/AGENTS.md`;
- `docs/refactor/DSH-WORKFLOW.md` (§6.10 the paragraph "一个运行里的类型检查"; §7.1 the step table row 10 and the paragraph "停止");
- `docs/refactor/HANDOFF.md` (decision 70, the new sub-bullet "C1 结果"); `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` §14 item 10.
`【lead 填】` marks the merge commit and the final full suite, which are not known yet; skip them.

The material the drafts cite is under `./.lead-ref/evidence/` (`books/`, `dsh/`, `codex/`, `checks/`; the evidence paths in the drafts are relative to that folder). Start with `books/c1-lead-rulings.md`; the DSH task was `books/c1-docs.md`.

Check every factual sentence of the drafts against the cited material and the code:
1. **Numbers**: run seconds / tokens / context peaks and the totals against `checks/dsh-runs.txt`; sizes per group and in total against `checks/group-stat.txt` and the merged tree (`git diff --shortstat` is not available to you; count from the material); the Codex 会出错 / 不整洁 counts per review against the last line of each `codex/*.out.md`; the G1 full-suite numbers against `checks/g1-full-suite.txt`; decision 70's estimate (`docs/refactor/HANDOFF.md` decision 70) and how the drafts compare it with the result.
2. **Citations**: does each cited book, ruling, review item, reply item or spec line say what the sentence claims? Flag wrong numbers of rulings, wrong item ids (SE-x, TA-x, ST-x, VW-x, N-x, XX-x, PE-x) and claims the source does not make.
3. **Code facts**: the 13 new shared modules exist under the named paths; every file:line and name the drafts cite holds in this tree (e.g. `views/track-read-model.ts:224`, `tasks/goal-settings-service.ts:105` `waitPredecessorWalk`, `tasks/goal-decision-reader.ts` `atLeastCursor`, `TaskClaimOutbox` = `DispatchOutboxRecord`, run-state's success shape, the two settings services' reads of `expected[0]`); the N0 provenance line is in 31 `src` files and none under `src/core/work-graph`.
4. **DSH-WORKFLOW §7.1 and §6.10 against HANDOFF decisions 76, 80 and 81**: every rule the edited text states is in the decisions (quote the item), none is invented, none of 81-1, 81-3, 81-4, 81-7 is misstated.
5. **Internal consistency** across the files (the same number or claim stated differently in two places).
6. **Completeness against `books/c1-lead-rulings.md`**: every ruling of §2 and every lead fix of §3 appears in `lead-acceptance.md` with the same content; the items moved to T and to the decision-84 review match rulings 3, 6, 7 and 8.

Output: a numbered list of problems (file:line of the draft, what is wrong, the correct text or fact with its source). Skip style. End with: problem count.
