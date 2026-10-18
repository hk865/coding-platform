# Task: K3 group 3, session 6 — one production gap (the D6 sentence for `unexpanded`); test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. Do not make design
decisions; report anything undetermined under UNSPECIFIED.

**This run is headless. When your turn ends, the whole run ends.** Work alone or with at most 2 subagents, every vitest
command `--maxWorkers=2`. **Finish within 50 minutes** (the run stops at 60).

## 1. What this copy is

Tag `k3-g3e` (HEAD) = K3 group 3 session 5 (your reply `./.dsh-ref/k3-g3e-final.md`). Codex's final check
(`./.dsh-ref/k3g3e-review.out.md`, Chinese) confirms your UNSPECIFIED as a group-3 production gap.

## 2. The item (binding)

`src/contracts/core/prepared-execution.ts` ~109–117 (`renderUnknownCallReviewZh`): the `unexpanded` branch `continue`s
early, so only `truncated` items get the full D6 sentence. The spec (`slice-K3-SPEC.md` ~358, ~1667) requires it for both
displays:

> 这条命令没有全文，两个结论（做没做完、会不会是崩溃的原因）一律按判断不了处理；你看到的痕迹照样写进依据。

Keep the short floor line of spec ~363 (`- #<alias> <tool>：没展开，按判断不了处理。`) and add the full sentence next to it
for `unexpanded` items, inside the existing capacity budget (the sentence counts toward the rendered text; the floor
rules and trim order do not change). Test first: `tests/scenarios/K3-42-unexpanded-r2.test.ts` ~168 asserts the full
sentence for the `unexpanded` item (today it checks only the short line), and the K3-35 / K3-48 capacity tests stay
green (report any literal that moves and why).

## 3. Checks

Every `K3-*` test file and `tests/architecture/` with `--maxWorkers=2`; `npm run typecheck`. No real model calls, no git
writes, never ports 3080/3099/44797.

## 4. Reply

Under 200 words: files changed, RED → GREEN, checks with numbers, UNSPECIFIED.
