Read-only second pass for the lead (HANDOFF decision 84-3: "再由 Codex 第二轮做反驳式核实，只留站得住的"). Do not write any file, do not run tests or builds. Answer in Chinese with file:line.

This copy is the lead branch right after cleanup round C1 merged. A first Codex pass reviewed the structure of one area; its report is `./.lead-ref/d84-struct-B.out.md` and its prompt `./.lead-ref/d84-struct-B.prompt.md` (read the prompt for the rules and the class definitions). The remaining slices' frozen specs are `docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md`, `slice-7-SPEC.md`, `slice-8-SPEC.md`; decisions 70, 79, 83 and 84 are in `docs/refactor/HANDOFF.md`.

**Try to refute every finding.** For each one, check against the code and the specs:
1. The file:line and the description are right (the code says what the finding says).
2. The cost is real (a concrete example of reading, changing or reusing that is harder because of it), not taste.
3. The slice and section it names really add code there (quote the spec line); "无" is right when no remaining slice touches it.
4. The change would not alter behaviour (codes, texts, check order, field presence, list order, store reads, stored bytes); if it would, say exactly where.
5. The line estimate is plausible (count the code involved).
6. The class follows decision 84-2 from 1–5.
7. It is not already covered by C1 (the cleanup list), by T (stale/duplicate/trivial tests, unused production code, code only for old data) or by a frozen spec that already says how the slice will do it.

Default to "不成立" when the finding is not supported by the code or the specs.

Output one table:

| # | 判定（成立 / 部分成立 / 不成立） | 理由（file:line 或 spec 行） | 修正后的归类和估计行数（成立和部分成立才填） | 修正后的说法（部分成立才填，一句） |

Then: findings the first pass missed that you are sure of (same columns as the first pass, at most five), and one line: 成立 / 部分成立 / 不成立 counts, and the class totals after your corrections.
