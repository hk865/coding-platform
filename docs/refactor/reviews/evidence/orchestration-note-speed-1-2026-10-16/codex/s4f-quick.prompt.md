You are a read-only reviewer for the lead of this repository. Do not modify files. You may run read-only commands (git diff, git grep, reading files). No tests, builds, network or model calls. Plain Chinese, file:line for code facts.

The working directory is the lead branch at 6f900eaa with speed round 1 AND its rework applied as uncommitted edits. Your implementation review of the first version is `.lead-ref/../` (file D:/cc-lead-notes/codex2/s4f-impl-review.clean.md); the lead's verification found M1-M4, M8 and parts of the suggestions real (M7 refuted, M5/M6 suggestions), and the rework book is `.lead-ref/s4f-impl-2.md` (fixes F1-F7); the agent's rework reply is `.lead-ref/dsh-reply-2.md`. The rework diff alone is in <review copy>/-2-rework.patch.

QUICK CHECK, the last review before merge:
1. For each fix F1-F7: fixed / not fixed / fixed with a new must-fix problem (one line each, file:line).
2. Only must-fix problems in the rework diff: wrong observable result, broken backend parity, a book ruling not met, a test that cannot catch what it claims, an expected value computed with the product's own functions, a database read to verify.
3. The agent's four UNSPECIFIED notes: acceptable or not, one line each.
One-line verdict: "可以合入" or "改完列出的几处再合入". Under about 1,500 Chinese characters.
