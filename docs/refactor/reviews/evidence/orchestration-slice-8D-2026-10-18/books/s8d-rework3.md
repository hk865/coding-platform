# Task: 8D rework, round 3 — three items left from Codex's quick check, plus small cleanups; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`); files disjoint, every vitest command `--maxWorkers=2`. **Do not end your turn while
a subagent has not reported back.** **Finish within 80 minutes** (the run stops at 90). Delete `./.dsh-scratch/`
(the directory itself too) before you end.

## 1. What this copy is

Tag `s8d-rw2` (HEAD) = the 8D rework after round 2 (book `./.dsh-ref/s8d-rework2.md`, your reply
`./.dsh-ref/s8d-rework2-final.md`). Codex's quick check of round 2: `./.dsh-ref/s8d-rw2-review.out.md` (Chinese):
items 1, 2, 4–7, 9–12 fixed; your UNSPECIFIED 1–6 accepted; three must-change items and three suggestions, below.

## 2. Items (binding)

1. **One source text for the include specifier (round-2 item 3, not finished).** Both paths (macro expanded and not)
   take the whole logical directive from the source — line continuations joined, no 400-byte cut, no two-line window
   — and hand it to the one extractor. A case with a block comment longer than 400 bytes before the specifier and a
   case with a continued directive, through the script or the platform rows.
2. **A-11 (2) as §11.6 writes it.** The wrapper forwards the real interpreter, prints the `garbage` line and then
   stays alive (hangs, does not exit); the platform ends it and records `python { edges: 'failed', reason:
   '分析运行失败：输出读不了', … }` with the existing literal assertions; TS unaffected. Memory and SQLite.
3. **Restore what old RUN-01 guarded, on real sources:** (a) when every unit of a file fails, the file's reason is
   chosen by the main-file rule (a real header that fails differently in two units through conditional compilation);
   (b) the same specifier with an edge in one unit and unresolved in another leaves only the edge (one `#include` of a
   macro defined by one compile command and not by the other). Literal expectations, hand-derived.
4. **Cleanups (Codex's suggestions):** remove the unreachable fill-in loop in `analysis-runner.ts` (~235–250) and the
   Python `implicit` parameter that no caller sets true; let A-06 use the shared platform fixture
   (`tests/helpers/S8D-platform-fixture.ts`) instead of its own initialisation, assertions unchanged.
5. **Reply corrections:** the replacement list (old RUN-04 → new RUN-03, old RUN-06 → new RUN-04, the script merge
   case → the nested-directory case), and UNSPECIFIED 6 (the engine is asserted as libclang).

## 3. Checks

`--maxWorkers=2`: `tests/data/`, `tests/composition/`, `tests/architecture/`, `tests/work-graph/`, every
`tests/**/S8*.test.ts`, the changed files; `npm run typecheck`, `npm run check:architecture`, `npm run build`;
`runtime-assets.json` digests updated and checked if a script changed. Failures listed in `DSH-BASELINE.md` are
expected (no bwrap). No real model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 400 words: files changed (production net; tests), each item RED → GREEN or how it was checked, checks with
numbers, UNSPECIFIED.
